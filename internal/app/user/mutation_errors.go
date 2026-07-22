package user

type MutationError struct {
	Status int
	Detail string
}

func (e MutationError) Error() string {
	return e.Detail
}

func clientError(status int, detail string) error {
	return MutationError{Status: status, Detail: detail}
}
