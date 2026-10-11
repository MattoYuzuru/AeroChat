package minio

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/minio-go/v7/pkg/lifecycle"
)

type Client struct {
	bootstrap      *minio.Client
	presign        *minio.Client
	bucket         string
	presignMu      sync.Mutex
	presignHost    string
	presignOptions minio.Options
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
	presignOptions := minio.Options{
		Creds:  creds,
		Secure: resolvedPresignSecure,
	}
	_, err = minio.New(presignHost, &presignOptions)
	if err != nil {
		return nil, fmt.Errorf("create presign minio client: %w", err)
	}

	return &Client{
		bootstrap:      bootstrapClient,
		bucket:         bucket,
		presignHost:    presignHost,
		presignOptions: presignOptions,
	}, nil
}

func (c *Client) presigningClient(ctx context.Context) (*minio.Client, error) {
	c.presignMu.Lock()
	defer c.presignMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.presign != nil {
		return c.presign, nil
	}

	// Public endpoint нужен только для подписи: region discovery выполняется внутри storage-сети.
	region, err := c.bootstrap.GetBucketLocation(ctx, c.bucket)
	if err != nil {
		return nil, fmt.Errorf("resolve media bucket region: %w", err)
	}
	options := c.presignOptions
	options.Region = region
	client, err := minio.New(c.presignHost, &options)
	if err != nil {
		return nil, fmt.Errorf("create regional presign client: %w", err)
	}
	c.presign = client
	return client, nil
}

func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.bootstrap.BucketExists(ctx, c.bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err := c.bootstrap.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{}); err != nil {
			return err
		}
	}
	return c.ensureStagingLifecycle(ctx)
}

func (c *Client) ensureStagingLifecycle(ctx context.Context) error {
	versioning, err := c.bootstrap.GetBucketVersioning(ctx, c.bucket)
	if err != nil {
		return err
	}
	if versioning.Status == "Enabled" {
		return fmt.Errorf("media bucket versioning must be disabled for bounded staging uploads")
	}
	config, err := c.bootstrap.GetBucketLifecycle(ctx, c.bucket)
	if err != nil {
		if minio.ToErrorResponse(err).Code != "NoSuchLifecycleConfiguration" {
			return err
		}
		config = &lifecycle.Configuration{}
	}
	const ruleID = "aerochat-staging-expiry"
	for _, rule := range config.Rules {
		if rule.ID != ruleID {
			continue
		}
		if rule.Status != "Enabled" || rule.RuleFilter.Prefix != "staging/" || rule.Expiration.Days != 1 {
			return fmt.Errorf("reserved staging lifecycle rule has incompatible configuration")
		}
		return nil
	}
	config.Rules = append(config.Rules, lifecycle.Rule{ID: ruleID, Status: "Enabled", RuleFilter: lifecycle.Filter{Prefix: "staging/"}, Expiration: lifecycle.Expiration{Days: 1}})
	return c.bootstrap.SetBucketLifecycle(ctx, c.bucket, config)
}

func (c *Client) CreateUpload(ctx context.Context, objectKey string, mimeType string, size int64, expiresAt time.Time) (*chat.PresignedObjectUpload, error) {
	expiry := time.Until(expiresAt)
	if expiry <= 0 {
		return nil, fmt.Errorf("upload session already expired")
	}

	presign, err := c.presigningClient(ctx)
	if err != nil {
		return nil, err
	}
	policy := minio.NewPostPolicy()
	for _, set := range []func() error{
		func() error { return policy.SetBucket(c.bucket) },
		func() error { return policy.SetKey(objectKey) },
		func() error { return policy.SetContentType(mimeType) },
		func() error { return policy.SetContentLengthRange(size, size) },
		func() error { return policy.SetExpires(expiresAt) },
	} {
		if err := set(); err != nil {
			return nil, err
		}
	}
	presignedURL, fields, err := presign.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return nil, err
	}

	return &chat.PresignedObjectUpload{
		URL:        presignedURL.String(),
		HTTPMethod: "POST",
		Headers:    map[string]string{},
		FormFields: fields,
		ExpiresAt:  expiresAt,
	}, nil
}

func (c *Client) CreateDownload(ctx context.Context, objectKey string, expiresAt time.Time) (*chat.PresignedObjectDownload, error) {
	expiry := time.Until(expiresAt)
	if expiry <= 0 {
		return nil, fmt.Errorf("download session already expired")
	}

	presign, err := c.presigningClient(ctx)
	if err != nil {
		return nil, err
	}
	params := make(url.Values)
	params.Set("response-content-type", "application/octet-stream")
	params.Set("response-content-disposition", "attachment")
	presignedURL, err := presign.PresignedGetObject(ctx, c.bucket, objectKey, expiry, params)
	if err != nil {
		return nil, err
	}

	return &chat.PresignedObjectDownload{
		URL:       presignedURL.String(),
		ExpiresAt: expiresAt,
	}, nil
}

func (c *Client) PromoteObject(ctx context.Context, source, destination, etag, contentType string) error {
	if source == destination || etag == "" {
		return fmt.Errorf("promotion requires distinct keys and source ETag")
	}
	_, err := c.bootstrap.CopyObject(ctx, minio.CopyDestOptions{
		Bucket: c.bucket, Object: destination, ReplaceMetadata: true,
		ContentType: contentType, ContentDisposition: "attachment",
	}, minio.CopySrcOptions{Bucket: c.bucket, Object: source, MatchETag: etag})
	return err
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

func (c *Client) DeleteObject(ctx context.Context, objectKey string) error {
	err := c.bootstrap.RemoveObject(ctx, c.bucket, objectKey, minio.RemoveObjectOptions{})
	if err == nil {
		return nil
	}

	response := minio.ToErrorResponse(err)
	if response.StatusCode == 404 || response.Code == "NoSuchKey" || response.Code == "NoSuchObject" {
		return nil
	}

	return err
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
