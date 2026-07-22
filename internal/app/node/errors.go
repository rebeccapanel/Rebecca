package node

import "fmt"

type ErrorKind string

const (
	ErrorNotFound ErrorKind = "not_found"
	ErrorConflict ErrorKind = "conflict"
	ErrorInvalid  ErrorKind = "invalid"
	ErrorExpired  ErrorKind = "expired"
)

type Error struct {
	Kind   ErrorKind
	Detail string
}

func (e Error) Error() string {
	if e.Detail != "" {
		return e.Detail
	}
	return string(e.Kind)
}

func typedError(kind ErrorKind, detail string) error {
	return Error{Kind: kind, Detail: detail}
}

func IsKind(err error, kind ErrorKind) bool {
	if err == nil {
		return false
	}
	if typed, ok := err.(Error); ok {
		return typed.Kind == kind
	}
	if typed, ok := err.(*Error); ok {
		return typed.Kind == kind
	}
	return false
}

func wrapInvalid(format string, args ...any) error {
	return typedError(ErrorInvalid, fmt.Sprintf(format, args...))
}
