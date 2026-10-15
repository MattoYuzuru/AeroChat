package notifications

import (
	"errors"
	"net/netip"
	"net/url"
	"strings"
)

var ErrWebPushEndpoint = errors.New("web push endpoint is not allowed")

func NormalizeWebPushEndpoint(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 4096 || strings.Contains(value, "#") {
		return "", ErrWebPushEndpoint
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Opaque != "" || u.User != nil || u.Host == "" {
		return "", ErrWebPushEndpoint
	}
	host := strings.ToLower(u.Hostname())
	if !allowedPushHostname(host) || (u.Port() != "" && u.Port() != "443") || strings.HasSuffix(u.Host, ":") {
		return "", ErrWebPushEndpoint
	}
	u.Host = host
	return u.String(), nil
}

func allowedPushHostname(host string) bool {
	if len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') && (character < '0' || character > '9') && character != '-' {
				return false
			}
		}
	}
	return host == "fcm.googleapis.com" || host == "updates.push.services.mozilla.com" || strings.HasSuffix(host, ".push.apple.com")
}

// Special-purpose ranges не являются обычными адресами push provider, даже если Go
// классифицирует их как global unicast. ADR-095 намеренно запрещает весь registry block.
var deniedPushPrefixes = [...]netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.31.196.0/24"), netip.MustParsePrefix("192.52.193.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("192.175.48.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("2620:4f:8000::/48"),
	netip.MustParsePrefix("3fff::/20"),
}

var pushIPv6Global = netip.MustParsePrefix("2000::/3")

func allowedPushAddress(address netip.Addr) bool {
	if !address.IsValid() || address.Zone() != "" {
		return false
	}
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || (address.Is6() && !pushIPv6Global.Contains(address)) {
		return false
	}
	for _, prefix := range deniedPushPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}
