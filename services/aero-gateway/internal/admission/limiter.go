package admission

import (
	"context"
	"crypto/sha256"
	"errors"
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
)

const MaxAuthRequestBytes = 4096

type Operation string

const (
	Register Operation = "register"
	Login    Operation = "login"
)

type key struct {
	scope  string
	digest [32]byte
}
type bucket struct {
	tokens   float64
	burst    int
	refill   time.Duration
	updated  time.Time
	lastSeen time.Time
	inFlight int
}

type Limiter struct {
	mu      sync.Mutex
	config  Config
	buckets map[key]*bucket
	now     func() time.Time
}

func NewLimiter(config Config) *Limiter {
	if config.maxKeys == 0 {
		config = DefaultConfig()
	}
	return &Limiter{config: config, buckets: make(map[key]*bucket), now: time.Now}
}

func (l *Limiter) Acquire(ctx context.Context, operation Operation, peer string, headers http.Header, login string) (func(), error) {
	if operation != Login && operation != Register {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("неподдерживаемая auth операция"))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	address, err := l.clientAddress(peer, headers)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("не удалось подтвердить адрес клиента"))
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	var accountKey key
	var account *bucket
	if operation == Login {
		accountKey = key{scope: "login-account", digest: sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(login))))}
		account = l.buckets[accountKey]
		if account != nil {
			if wait := account.wait(now, 1); wait > 0 {
				return nil, exhausted(wait)
			}
		}
	}
	ipKey := key{scope: string(operation), digest: sha256.Sum256([]byte(address.String()))}
	burst, refill, maxInFlight := l.config.loginBurst, l.config.loginRefill, 2
	if operation == Register {
		burst, refill, maxInFlight = l.config.registerBurst, l.config.registerRefill, 1
	}
	ip := l.buckets[ipKey]
	if ip != nil {
		if wait := ip.wait(now, maxInFlight); wait > 0 {
			return nil, exhausted(wait)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	needed := 0
	if ip == nil {
		needed++
	}
	if operation == Login && account == nil {
		needed++
	}
	if !l.makeRoom(needed, now) {
		return nil, exhausted(time.Second)
	}
	// Новые keys создаются только после всех refusal checks: заблокированный IP
	// не может заполнить таблицу ротацией login без расходования своего budget.
	if operation == Login && account == nil {
		account = l.getBucket(accountKey, l.config.accountBurst, l.config.accountRefill, now)
	}
	if ip == nil {
		ip = l.getBucket(ipKey, burst, refill, now)
	}
	ip.tokens--
	ip.inFlight++
	if account != nil {
		account.tokens--
		account.inFlight++
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			ip.inFlight--
			if account != nil {
				account.inFlight--
			}
		})
	}, nil
}

func (l *Limiter) getBucket(k key, burst int, refill time.Duration, now time.Time) *bucket {
	if existing := l.buckets[k]; existing != nil {
		return existing
	}
	value := &bucket{tokens: float64(burst), burst: burst, refill: refill, updated: now, lastSeen: now}
	l.buckets[k] = value
	return value
}

func (l *Limiter) makeRoom(needed int, now time.Time) bool {
	if len(l.buckets)+needed > l.config.maxKeys {
		for candidate, value := range l.buckets {
			if value.inFlight == 0 && now.Sub(value.lastSeen) >= 2*time.Hour && value.refilledTokens(now) >= float64(value.burst) {
				delete(l.buckets, candidate)
			}
		}
	}
	return len(l.buckets)+needed <= l.config.maxKeys
}

func (b *bucket) refilledTokens(now time.Time) float64 {
	elapsed := now.Sub(b.updated)
	if elapsed <= 0 {
		return b.tokens
	}
	return math.Min(float64(b.burst), b.tokens+float64(elapsed)/float64(b.refill))
}

func (b *bucket) wait(now time.Time, maxInFlight int) time.Duration {
	b.tokens = b.refilledTokens(now)
	if now.After(b.updated) {
		b.updated = now
	}
	b.lastSeen = now
	if b.inFlight >= maxInFlight {
		return time.Second
	}
	if b.tokens < 1 {
		return time.Duration(math.Ceil((1 - b.tokens) * float64(b.refill)))
	}
	return 0
}

func exhausted(wait time.Duration) error {
	err := connect.NewError(connect.CodeResourceExhausted, errors.New("слишком много запросов входа или регистрации: повторите позже"))
	seconds := max(int64(1), int64(math.Ceil(wait.Seconds())))
	err.Meta().Set("Retry-After", strconv.FormatInt(seconds, 10))
	return err
}

func (l *Limiter) clientAddress(peer string, headers http.Header) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(peer)
	if err != nil {
		return netip.Addr{}, err
	}
	address, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, err
	}
	address = address.Unmap()
	for _, prefix := range l.config.trustedProxies {
		if !prefix.Contains(address) {
			continue
		}
		values := headers.Values("X-Real-IP")
		if len(values) != 1 {
			return netip.Addr{}, errors.New("trusted peer requires one client address")
		}
		forwarded, err := netip.ParseAddr(values[0])
		if err != nil || forwarded.Zone() != "" {
			return netip.Addr{}, errors.New("invalid forwarded address")
		}
		return forwarded.Unmap(), nil
	}
	return address, nil
}
