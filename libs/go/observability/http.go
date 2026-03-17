package observability

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
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
	mux.Handle("GET /", WrapHTTPInstrumentation(logger, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"service": meta,
			"status":  "ok",
		})
	})))
	mux.Handle("GET /healthz", WrapHTTPInstrumentation(logger, healthHandler(meta)))
	mux.Handle("GET /readyz", WrapHTTPInstrumentation(logger, readinessHandler(meta, check)))

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

// WrapHTTPInstrumentation логирует HTTP-запрос и не даёт panic закрыть соединение без ответа.
func WrapHTTPInstrumentation(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		recorder := &statusRecorder{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error(
					"panic при обработке http-запроса",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Any("panic", recovered),
					slog.String("stack", string(debug.Stack())),
				)
				if !recorder.wroteHeader {
					writeJSON(recorder, http.StatusInternalServerError, map[string]any{
						"code":    "internal",
						"message": "Внутренняя ошибка сервиса.",
					})
				}
			}

			logger.Info(
				"http-запрос обработан",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status_code", recorder.statusCode),
				slog.Duration("duration", time.Since(startedAt)),
				slog.String("remote_addr", r.RemoteAddr),
			)
		}()

		next.ServeHTTP(recorder, r)
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)

	_ = json.NewEncoder(w).Encode(payload)
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode  int
	wroteHeader bool
}

func (r *statusRecorder) Write(body []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(r.statusCode)
	}

	return r.ResponseWriter.Write(body)
}

func (r *statusRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(statusCode)
}
