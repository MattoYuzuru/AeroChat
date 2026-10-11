package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/postgres"
)

func main() {
	profile := flag.String("env-file", "", "вне-Git профиль с AERO_DATABASE_URL")
	execute := flag.Bool("execute", false, "выполнить metadata backfill")
	writersStopped := flag.Bool("writers-stopped", false, "оператор подтвердил остановку всех writers и verified backup/restore")
	batchSize := flag.Int("batch-size", 100, "rows на conversation за запуск (1–1000)")
	conversationLimit := flag.Int("conversations", 10, "conversation batches за запуск (1–100)")
	flag.Parse()
	if err := run(*profile, *execute, *writersStopped, *batchSize, *conversationLimit); err != nil {
		fmt.Fprintln(os.Stderr, "Sequence backfill не завершён; проверьте profile/schema, остановку writers и bounded batch. Database URL и payload не выводятся.")
		os.Exit(1)
	}
}

func run(path string, execute, writersStopped bool, batchSize, conversationLimit int) error {
	if path == "" || (execute && !writersStopped) || batchSize < 1 || batchSize > 1000 || conversationLimit < 1 || conversationLimit > 100 {
		return fmt.Errorf("invalid backfill options")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dsn := ""
	for _, line := range strings.Split(string(data), "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "AERO_DATABASE_URL="); ok {
			dsn = strings.TrimSpace(value)
		}
	}
	if dsn == "" {
		return fmt.Errorf("missing database profile field")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	report, err := postgres.NewRepository(db).BackfillEncryptedSequences(ctx, execute, int32(batchSize), int32(conversationLimit))
	if report != nil {
		fmt.Printf("execute=%t conversations=%d candidates=%d migrated=%d ready=%t\n", execute, report.Conversations, report.Candidates, report.Migrated, report.Ready)
	}
	return err
}
