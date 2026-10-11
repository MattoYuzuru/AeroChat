package main

import "testing"

func TestBackfillRefusesUnacknowledgedExecuteBeforeOpeningProfile(t *testing.T) {
	for _, options := range []struct {
		path                 string
		execute, stopped     bool
		batch, conversations int
	}{
		{"", false, false, 100, 10},
		{"/fixture/should-never-open", true, false, 100, 10},
		{"/fixture/should-never-open", true, true, 0, 10},
		{"/fixture/should-never-open", true, true, 1001, 10},
		{"/fixture/should-never-open", true, true, 100, 0},
		{"/fixture/should-never-open", true, true, 100, 101},
	} {
		if err := run(options.path, options.execute, options.stopped, options.batch, options.conversations); err == nil || err.Error() != "invalid backfill options" {
			t.Fatalf("maintenance prerequisite failed before profile/network access: %v", err)
		}
	}
}
