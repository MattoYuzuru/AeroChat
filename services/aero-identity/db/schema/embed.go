package schema

import "embed"

// Files содержит встроенные SQL-файлы bootstrap для identity schema.
//
//go:embed *.sql
var Files embed.FS
