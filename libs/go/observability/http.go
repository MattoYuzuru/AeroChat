package observability

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// ServiceMeta описывает минимальные метаданные сервиса для диагностических ответов.
type ServiceMeta struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// HTTPServerConfig описывает базовые настройки HTTP-сервера.
type HTTPServerConfig struct {
	Address         string
	ShutdownTimeout time.Duration
}

// ReadinessCheck позволяет сервису подключить собственную проверку готовности позже.
type ReadinessCheck func(ctx context.Context) error

// NewBaseMux создаёт минимальный mux с health/readiness и корневой диагностикой.
func NewBaseMux(meta ServiceMeta, logger *slog.Logger, check ReadinessCheck) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("GET /", requestLogger(logger, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"service": meta,
			"status":  "ok",
		})
	})))
	mux.Handle("GET /healthz", requestLogger(logger, healthHandler(meta)))
	mux.Handle("GET /readyz", requestLogger(logger, readinessHandler(meta, check)))

	return mux
}

// RunHTTPServer запускает HTTP-сервер и корректно завершает его при отмене контекста.
func RunHTTPServer(ctx context.Context, logger *slog.Logger, cfg HTTPServerConfig, handler http.Handler) error {
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("http-сервер запускается", slog.String("address", cfg.Address))
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()

		logger.Info("http-сервер завершает работу")
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}

		err := <-serverErrors
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}

		return nil
	}
}

func healthHandler(meta ServiceMeta) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"service": meta,
			"status":  "healthy",
		})
	})
}

func readinessHandler(meta ServiceMeta, check ReadinessCheck) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if check != nil {
			if err := check(r.Context()); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{
					"service": meta,
					"status":  "not_ready",
					"error":   err.Error(),
				})
				return
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"service": meta,
			"status":  "ready",
		})
	})
}

func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		recorder := &statusRecorder{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		next.ServeHTTP(recorder, r)

		logger.Info(
			"http-запрос обработан",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status_code", recorder.statusCode),
			slog.Duration("duration", time.Since(startedAt)),
			slog.String("remote_addr", r.RemoteAddr),
		)
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)

	_ = json.NewEncoder(w).Encode(payload)
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *statusRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}
