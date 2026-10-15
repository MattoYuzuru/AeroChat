package mediacontract

// ChatRevocation моделирует уже проверенное source событие; transport verification
// и durable delivery здесь отсутствуют, production code модель не импортирует.
type ChatRevocation struct {
	GroupID          string
	UserID           string
	EligibilityEpoch int64
}

func (m *ReferenceModel) ApplyChatRevocation(event ChatRevocation) error {
	if event.GroupID != m.binding.GroupID || event.UserID != m.binding.UserID || event.EligibilityEpoch <= 0 {
		return ErrDenied
	}
	if event.EligibilityEpoch < m.binding.EligibilityEpoch {
		return nil
	}
	return m.BeginRevoke()
}
