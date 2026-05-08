package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"unsafe"

	"github.com/rebeccapanel/rebecca/go/internal/bridge"
)

//export RebeccaBridgeCall
func RebeccaBridgeCall(input *C.char) *C.char {
	if input == nil {
		return C.CString(`{"ok":false,"error":"empty request"}`)
	}
	output := bridge.Call([]byte(C.GoString(input)))
	return C.CString(string(output))
}

//export RebeccaBridgeFree
func RebeccaBridgeFree(ptr *C.char) {
	if ptr != nil {
		C.free(unsafe.Pointer(ptr))
	}
}

func main() {}
