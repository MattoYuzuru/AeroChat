package dbbootstrap

import (
	"io/fs"
	"testing"
	"testing/fstest"
)

func TestCollectPendingMigrationsSortsFilesAndSkipsApplied(t *testing.T) {
	t.Parallel()

	files := fstest.MapFS{
		"schema/000002_third.sql":   &fstest.MapFile{Data: []byte("SELECT 3;")},
		"schema/000001_second.sql":  &fstest.MapFile{Data: []byte("SELECT 2;")},
		"schema/000000_first.sql":   &fstest.MapFile{Data: []byte("SELECT 1;")},
		"schema/README.txt":         &fstest.MapFile{Data: []byte("ignored")},
		"schema/subdir/skip.sql":    &fstest.MapFile{Data: []byte("ignored")},
		"schema/subdir/nested.json": &fstest.MapFile{Data: []byte("{}")},
	}

	firstChecksum := migrationChecksum([]byte("SELECT 1;"))

	pending, err := collectPendingMigrations(Options{
		ServiceName:   "aero-test",
		Files:         fs.FS(files),
		MigrationsDir: "schema",
	}, map[string]appliedMigration{
		"000000_first.sql": {
			Name:     "000000_first.sql",
			Checksum: firstChecksum,
		},
	})
	if err != nil {
		t.Fatalf("collect pending migrations: %v", err)
	}

	if len(pending) != 2 {
		t.Fatalf("ожидалось 2 pending migration, получено %d", len(pending))
	}
	if pending[0].Name != "000001_second.sql" {
		t.Fatalf("ожидалась первая pending migration 000001_second.sql, получено %q", pending[0].Name)
	}
	if pending[1].Name != "000002_third.sql" {
		t.Fatalf("ожидалась вторая pending migration 000002_third.sql, получено %q", pending[1].Name)
	}
}

func TestCollectPendingMigrationsRejectsChecksumDrift(t *testing.T) {
	t.Parallel()

	files := fstest.MapFS{
		"schema/000000_first.sql": &fstest.MapFile{Data: []byte("SELECT 1;")},
	}

	_, err := collectPendingMigrations(Options{
		ServiceName:   "aero-test",
		Files:         fs.FS(files),
		MigrationsDir: "schema",
	}, map[string]appliedMigration{
		"000000_first.sql": {
			Name:     "000000_first.sql",
			Checksum: "stale-checksum",
		},
	})
	if err == nil {
		t.Fatal("ожидалась ошибка checksum drift")
	}
}
