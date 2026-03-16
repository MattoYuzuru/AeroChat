package auth

import "testing"

func TestPasswordHasherHashAndVerify(t *testing.T) {
	t.Parallel()

	hasher := NewPasswordHasher()
	hash, err := hasher.Hash("CorrectHorseBatteryStaple1")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	valid, err := hasher.Verify("CorrectHorseBatteryStaple1", hash)
	if err != nil {
		t.Fatalf("verify password: %v", err)
	}
	if !valid {
		t.Fatal("ожидалась успешная проверка корректного пароля")
	}

	valid, err = hasher.Verify("wrong-password", hash)
	if err != nil {
		t.Fatalf("verify wrong password: %v", err)
	}
	if valid {
		t.Fatal("неверный пароль не должен проходить проверку")
	}
}

func TestPasswordHasherRejectsMalformedHash(t *testing.T) {
	t.Parallel()

	hasher := NewPasswordHasher()
	if _, err := hasher.Verify("password", "broken"); err == nil {
		t.Fatal("ожидалась ошибка для повреждённого password hash")
	}
}
