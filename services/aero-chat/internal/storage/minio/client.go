package minio

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	bootstrap *minio.Client
	presign   *minio.Client
	bucket    string
}

func NewClient(
	internalEndpoint string,
	internalSecure bool,
	presignEndpoint string,
	presignSecure bool,
	accessKey string,
	secretKey string,
	bucket string,
) (*Client, error) {
	if strings.TrimSpace(bucket) == "" {
		return nil, fmt.Errorf("bucket is required")
	}

	internalHost, resolvedInternalSecure, err := resolveEndpoint(internalEndpoint, internalSecure)
	if err != nil {
		return nil, fmt.Errorf("resolve internal endpoint: %w", err)
	}
	presignHost, resolvedPresignSecure, err := resolveEndpoint(presignEndpoint, presignSecure)
	if err != nil {
		return nil, fmt.Errorf("resolve presign endpoint: %w", err)
	}

	creds := credentials.NewStaticV4(accessKey, secretKey, "")
	bootstrapClient, err := minio.New(internalHost, &minio.Options{
		Creds:  creds,
		Secure: resolvedInternalSecure,
	})
	if err != nil {
		return nil, fmt.Errorf("create internal minio client: %w", err)
	}
	presignClient, err := minio.New(presignHost, &minio.Options{
		Creds:  creds,
		Secure: resolvedPresignSecure,
	})
	if err != nil {
		return nil, fmt.Errorf("create presign minio client: %w", err)
	}

	return &Client{
		bootstrap: bootstrapClient,
		presign:   presignClient,
		bucket:    bucket,
	}, nil
}

func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.bootstrap.BucketExists(ctx, c.bucket)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	return c.bootstrap.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{})
}

func (c *Client) CreateUpload(ctx context.Context, objectKey string, mimeType string, expiresAt time.Time) (*chat.PresignedObjectUpload, error) {
	expiry := time.Until(expiresAt)
	if expiry <= 0 {
		return nil, fmt.Errorf("upload session already expired")
	}

	presignedURL, err := c.presign.PresignedPutObject(ctx, c.bucket, objectKey, expiry)
	if err != nil {
		return nil, err
	}

	headers := make(map[string]string, 1)
	if mimeType != "" {
		headers["Content-Type"] = mimeType
	}

	return &chat.PresignedObjectUpload{
		URL:        presignedURL.String(),
		HTTPMethod: "PUT",
		Headers:    headers,
		ExpiresAt:  expiresAt,
	}, nil
}

func (c *Client) StatObject(ctx context.Context, objectKey string) (*chat.StoredObjectInfo, error) {
	info, err := c.bootstrap.StatObject(ctx, c.bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		return nil, err
	}

	return &chat.StoredObjectInfo{
		Size:        info.Size,
		ETag:        info.ETag,
		ContentType: info.ContentType,
	}, nil
}

func (c *Client) BucketName() string {
	return c.bucket
}

func resolveEndpoint(raw string, fallbackSecure bool) (string, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false, fmt.Errorf("endpoint is required")
	}

	if !strings.Contains(trimmed, "://") {
		return trimmed, fallbackSecure, nil
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false, err
	}
	if parsed.Host == "" {
		return "", false, fmt.Errorf("endpoint host is required")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false, fmt.Errorf("endpoint path is not supported")
	}

	switch parsed.Scheme {
	case "http":
		return parsed.Host, false, nil
	case "https":
		return parsed.Host, true, nil
	default:
		return "", false, fmt.Errorf("unsupported endpoint scheme %q", parsed.Scheme)
	}
}
