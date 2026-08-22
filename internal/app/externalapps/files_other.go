//go:build !linux

package externalapps

import "os"

func FileHasMultipleLinks(os.FileInfo) bool {
	return false
}
