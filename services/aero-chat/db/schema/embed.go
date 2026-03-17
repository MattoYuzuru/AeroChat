package schema

import "embed"

// Files содержит встроенные SQL-файлы bootstrap для chat schema.
//
//go:embed *.sql
var Files embed.FS
