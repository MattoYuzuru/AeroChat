package dbbootstrap

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	migrationsTableName = "schema_migrations"
	globalAdvisoryLock  = int64(367281451902641915)
	defaultPollInterval = 500 * time.Millisecond
)

type Options struct {
	ServiceName   string
	Files         fs.FS
	Logger        *slog.Logger
	Requirements  []Requirement
	WaitTimeout   time.Duration
	PollInterval  time.Duration
	MigrationsDir string
}

type Requirement struct {
	ServiceName string
	Migration   string
}

type appliedMigration struct {
	Name     string
	Checksum string
}

type pendingMigration struct {
	Name     string
	Checksum string
	SQL      string
}

type dependencyError struct {
	serviceName string
	migration   string
}

func (e dependencyError) Error() string {
	return fmt.Sprintf("ожидается bootstrap %s:%s", e.serviceName, e.migration)
}

func Apply(ctx context.Context, db *pgxpool.Pool, options Options) error {
	if strings.TrimSpace(options.ServiceName) == "" {
		return errors.New("service name обязателен для database bootstrap")
	}
	if options.Files == nil {
		return errors.New("fs с миграциями обязателен для database bootstrap")
	}

	if options.WaitTimeout <= 0 {
		options.WaitTimeout = 30 * time.Second
	}
	if options.PollInterval <= 0 {
		options.PollInterval = defaultPollInterval
	}

	deadlineCtx, cancel := context.WithTimeout(ctx, options.WaitTimeout)
	defer cancel()

	waitLogged := false
	for {
		err := applyOnce(deadlineCtx, db, options)
		if err == nil {
			return nil
		}

		var dependencyErr dependencyError
		if !errors.As(err, &dependencyErr) {
			return err
		}

		if !waitLogged {
			logInfo(
				options.Logger,
				"ожидание обязательного bootstrap схемы",
				slog.String("service_name", options.ServiceName),
				slog.String("required_service", dependencyErr.serviceName),
				slog.String("required_migration", dependencyErr.migration),
			)
			waitLogged = true
		}

		timer := time.NewTimer(options.PollInterval)
		select {
		case <-deadlineCtx.Done():
			timer.Stop()
			return fmt.Errorf("bootstrap схемы %s: %w", options.ServiceName, deadlineCtx.Err())
		case <-timer.C:
		}
	}
}

func applyOnce(ctx context.Context, db *pgxpool.Pool, options Options) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin bootstrap tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", globalAdvisoryLock); err != nil {
		return fmt.Errorf("acquire bootstrap lock: %w", err)
	}
	if err := ensureMigrationsTable(ctx, tx); err != nil {
		return err
	}
	if err := ensureRequirements(ctx, tx, options.Requirements); err != nil {
		return err
	}

	applied, err := loadAppliedMigrations(ctx, tx, options.ServiceName)
	if err != nil {
		return err
	}

	pending, err := collectPendingMigrations(options, applied)
	if err != nil {
		return err
	}

	if len(pending) == 0 {
		logInfo(
			options.Logger,
			"bootstrap схемы актуален",
			slog.String("service_name", options.ServiceName),
		)
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit bootstrap tx: %w", err)
		}
		return nil
	}

	for _, migration := range pending {
		if _, err := tx.Exec(ctx, migration.SQL); err != nil {
			return fmt.Errorf("apply migration %s:%s: %w", options.ServiceName, migration.Name, err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO schema_migrations (service_name, migration_name, checksum, applied_at)
			VALUES ($1, $2, $3, NOW())
		`, options.ServiceName, migration.Name, migration.Checksum); err != nil {
			return fmt.Errorf("store migration state %s:%s: %w", options.ServiceName, migration.Name, err)
		}

		logInfo(
			options.Logger,
			"миграция применена",
			slog.String("service_name", options.ServiceName),
			slog.String("migration_name", migration.Name),
		)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bootstrap tx: %w", err)
	}

	return nil
}

func ensureMigrationsTable(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			service_name TEXT NOT NULL,
			migration_name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL,
			PRIMARY KEY (service_name, migration_name)
		)
	`)
	if err != nil {
		return fmt.Errorf("ensure %s table: %w", migrationsTableName, err)
	}

	return nil
}

func ensureRequirements(ctx context.Context, tx pgx.Tx, requirements []Requirement) error {
	for _, requirement := range requirements {
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM schema_migrations
				WHERE service_name = $1 AND migration_name = $2
			)
		`, requirement.ServiceName, requirement.Migration).Scan(&exists); err != nil {
			return fmt.Errorf("check bootstrap requirement %s:%s: %w", requirement.ServiceName, requirement.Migration, err)
		}
		if !exists {
			return dependencyError{
				serviceName: requirement.ServiceName,
				migration:   requirement.Migration,
			}
		}
	}

	return nil
}

func loadAppliedMigrations(ctx context.Context, tx pgx.Tx, serviceName string) (map[string]appliedMigration, error) {
	rows, err := tx.Query(ctx, `
		SELECT migration_name, checksum
		FROM schema_migrations
		WHERE service_name = $1
	`, serviceName)
	if err != nil {
		return nil, fmt.Errorf("load applied migrations for %s: %w", serviceName, err)
	}
	defer rows.Close()

	applied := make(map[string]appliedMigration)
	for rows.Next() {
		var migration appliedMigration
		if err := rows.Scan(&migration.Name, &migration.Checksum); err != nil {
			return nil, fmt.Errorf("scan applied migration for %s: %w", serviceName, err)
		}
		applied[migration.Name] = migration
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applied migrations for %s: %w", serviceName, err)
	}

	return applied, nil
}

func collectPendingMigrations(options Options, applied map[string]appliedMigration) ([]pendingMigration, error) {
	root := "."
	if options.MigrationsDir != "" {
		root = options.MigrationsDir
	}

	entries, err := fs.ReadDir(options.Files, root)
	if err != nil {
		return nil, fmt.Errorf("read migrations for %s: %w", options.ServiceName, err)
	}

	pending := make([]pendingMigration, 0, len(entries))
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		names = append(names, entry.Name())
	}

	sort.Strings(names)

	for _, name := range names {
		contents, err := fs.ReadFile(options.Files, path.Join(root, name))
		if err != nil {
			return nil, fmt.Errorf("read migration %s:%s: %w", options.ServiceName, name, err)
		}

		checksum := migrationChecksum(contents)
		if appliedMigration, exists := applied[name]; exists {
			if appliedMigration.Checksum != checksum {
				return nil, fmt.Errorf(
					"migration %s:%s уже применена с другим checksum",
					options.ServiceName,
					name,
				)
			}
			continue
		}

		pending = append(pending, pendingMigration{
			Name:     name,
			Checksum: checksum,
			SQL:      string(contents),
		})
	}

	return pending, nil
}

func migrationChecksum(contents []byte) string {
	sum := sha256.Sum256(contents)
	return hex.EncodeToString(sum[:])
}

func logInfo(logger *slog.Logger, message string, attrs ...slog.Attr) {
	if logger == nil {
		return
	}

	args := make([]any, 0, len(attrs))
	for _, attr := range attrs {
		args = append(args, attr)
	}
	logger.Info(message, args...)
}
