package admission

import "testing"

func TestLoadConfigRejectsUnsafeValues(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"AERO_AUTH_REGISTER_BURST", "0"},
		{"AERO_AUTH_LOGIN_IP_BURST", "invalid"},
		{"AERO_AUTH_LOGIN_ACCOUNT_BURST", "-1"},
		{"AERO_AUTH_MAX_BUCKET_KEYS", "100001"},
		{"AERO_AUTH_REGISTER_REFILL_INTERVAL", "0s"},
		{"AERO_AUTH_LOGIN_IP_REFILL_INTERVAL", "-1s"},
		{"AERO_AUTH_LOGIN_ACCOUNT_REFILL_INTERVAL", "25h"},
		{"AERO_AUTH_TRUSTED_PROXY_CIDRS", "127.0.0.1"},
		{"AERO_AUTH_TRUSTED_PROXY_CIDRS", "0.0.0.0/0"},
		{"AERO_AUTH_TRUSTED_PROXY_CIDRS", "127.0.0.1/32,"},
		{"AERO_AUTH_TRUSTED_PROXY_CIDRS", "192.0.2.1/24"},
	} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := LoadConfig(); err == nil {
				t.Fatal("unsafe admission config must fail startup")
			}
		})
	}
}

func TestLoadConfigAcceptsOwnedProxyRanges(t *testing.T) {
	t.Setenv("AERO_AUTH_TRUSTED_PROXY_CIDRS", "127.0.0.1/32,::1/128")
	cfg, err := LoadConfig()
	if err != nil || len(cfg.trustedProxies) != 2 {
		t.Fatalf("trusted proxy config: %v", err)
	}
}
