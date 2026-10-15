package admission

import (
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	registerBurst  int
	registerRefill time.Duration
	loginBurst     int
	loginRefill    time.Duration
	accountBurst   int
	accountRefill  time.Duration
	maxKeys        int
	trustedProxies []netip.Prefix
}

func DefaultConfig() Config {
	return Config{registerBurst: 3, registerRefill: 10 * time.Minute, loginBurst: 20, loginRefill: time.Second, accountBurst: 5, accountRefill: 6 * time.Second, maxKeys: 4096}
}

func LoadConfig() (Config, error) {
	cfg := DefaultConfig()
	for _, field := range []struct {
		name   string
		target *int
		upper  int
	}{
		{"AERO_AUTH_REGISTER_BURST", &cfg.registerBurst, 1000},
		{"AERO_AUTH_LOGIN_IP_BURST", &cfg.loginBurst, 1000},
		{"AERO_AUTH_LOGIN_ACCOUNT_BURST", &cfg.accountBurst, 1000},
		{"AERO_AUTH_MAX_BUCKET_KEYS", &cfg.maxKeys, 100000},
	} {
		if raw := os.Getenv(field.name); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value <= 0 || value > field.upper {
				return Config{}, fmt.Errorf("переменная %s: требуется число от 1 до %d", field.name, field.upper)
			}
			*field.target = value
		}
	}
	for _, field := range []struct {
		name   string
		target *time.Duration
	}{
		{"AERO_AUTH_REGISTER_REFILL_INTERVAL", &cfg.registerRefill},
		{"AERO_AUTH_LOGIN_IP_REFILL_INTERVAL", &cfg.loginRefill},
		{"AERO_AUTH_LOGIN_ACCOUNT_REFILL_INTERVAL", &cfg.accountRefill},
	} {
		if raw := os.Getenv(field.name); raw != "" {
			value, err := time.ParseDuration(raw)
			if err != nil || value <= 0 || value > 24*time.Hour {
				return Config{}, fmt.Errorf("переменная %s: требуется положительная длительность не более 24h", field.name)
			}
			*field.target = value
		}
	}
	if raw := os.Getenv("AERO_AUTH_TRUSTED_PROXY_CIDRS"); raw != "" {
		for _, value := range strings.Split(raw, ",") {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
			if err != nil || prefix != prefix.Masked() || prefix.Bits() == 0 || prefix.Addr().Is4In6() {
				return Config{}, fmt.Errorf("переменная AERO_AUTH_TRUSTED_PROXY_CIDRS: требуется canonical non-global CIDR")
			}
			cfg.trustedProxies = append(cfg.trustedProxies, prefix)
		}
	}
	return cfg, nil
}
