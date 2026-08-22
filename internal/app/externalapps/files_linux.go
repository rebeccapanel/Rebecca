//go:build linux

package externalapps

import (
	"os"
	"syscall"
)

func FileHasMultipleLinks(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return !ok || stat.Nlink != 1
}
