package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	mediastorage "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/minio"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/postgres"
)

func main() {
	profile := flag.String("env-file", "", "вне-Git профиль AERO_DATABASE_URL/AERO_MEDIA_S3_*")
	execute := flag.Bool("execute", false, "явно выполнить conditional copy и metadata update")
	limit := flag.Int("limit", 100, "максимум записей за один запуск (1–100)")
	flag.Parse()
	if err := run(*profile, *execute, *limit); err != nil {
		fmt.Fprintln(os.Stderr, "Backfill не завершён; проверьте schema, expiry/grace и storage metadata. Секреты и object URLs не выводятся.")
		os.Exit(1)
	}
}

func run(path string, execute bool, limit int) error {
	if path == "" || limit < 1 || limit > 100 {
		return fmt.Errorf("invalid migration options")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	profile := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && strings.HasPrefix(key, "AERO_") {
			profile[key] = strings.TrimSpace(value)
		}
	}
	for _, key := range []string{"AERO_DATABASE_URL", "AERO_MEDIA_S3_INTERNAL_ENDPOINT", "AERO_MEDIA_S3_PRESIGN_ENDPOINT", "AERO_MEDIA_S3_ACCESS_KEY", "AERO_MEDIA_S3_SECRET_KEY", "AERO_MEDIA_S3_BUCKET"} {
		if profile[key] == "" {
			return fmt.Errorf("missing migration profile field")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	db, err := pgxpool.New(ctx, profile["AERO_DATABASE_URL"])
	if err != nil {
		return err
	}
	defer db.Close()
	storage, err := mediastorage.NewClient(profile["AERO_MEDIA_S3_INTERNAL_ENDPOINT"], profile["AERO_MEDIA_S3_INTERNAL_SECURE"] == "true", profile["AERO_MEDIA_S3_PRESIGN_ENDPOINT"], profile["AERO_MEDIA_S3_PRESIGN_SECURE"] == "true", profile["AERO_MEDIA_S3_ACCESS_KEY"], profile["AERO_MEDIA_S3_SECRET_KEY"], profile["AERO_MEDIA_S3_BUCKET"])
	if err != nil {
		return err
	}
	report, err := chat.BackfillLegacyAttachments(ctx, postgres.NewRepository(db), storage, execute, int32(limit), time.Now().UTC())
	if report != nil {
		fmt.Printf("execute=%t candidates=%d promoted=%d\n", execute, report.Candidates, report.Promoted)
	}
	return err
}
