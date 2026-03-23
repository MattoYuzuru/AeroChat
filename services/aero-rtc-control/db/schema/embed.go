package schema

import "embed"

// Files содержит встроенные SQL-файлы bootstrap для rtc-control schema.
//
//go:embed *.sql
var Files embed.FS
