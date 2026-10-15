package minio

import (
	"context"
	"errors"
	"time"
)

func (c *Client) ReadinessCheck(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	exists, err := c.bootstrap.BucketExists(ctx, c.bucket)
	if err != nil || !exists {
		// Ошибки SDK могут содержать upstream response; diagnostic surface возвращает только dependency status.
		return errors.New("media object storage is not ready")
	}
	return nil
}
