package repository

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

const userConfigCipherPrefix = "enc:v1:"

func userConfigAEAD() (cipher.AEAD, error) {
	key := strings.TrimSpace(config.Cfg.ConfigEncryptionKey)
	if key == "" {
		key = config.Cfg.JWTSecret
	}
	keyHash := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func encryptUserModelConfig(raw string) (string, error) {
	return transformUserModelConfig(raw, true)
}

func decryptUserModelConfig(raw string) (string, error) {
	return transformUserModelConfig(raw, false)
}

func transformUserModelConfig(raw string, encrypt bool) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return raw, nil
	}
	var configData map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &configData); err != nil {
		return "", err
	}
	channelsRaw, ok := configData["localChannels"]
	if !ok {
		return raw, nil
	}
	var channels []map[string]json.RawMessage
	if err := json.Unmarshal(channelsRaw, &channels); err != nil {
		return "", err
	}
	changed := false
	for _, channel := range channels {
		apiKeyRaw, ok := channel["apiKey"]
		if !ok {
			continue
		}
		var apiKey string
		if err := json.Unmarshal(apiKeyRaw, &apiKey); err != nil {
			return "", err
		}
		if encrypt {
			if apiKey == "" || strings.HasPrefix(apiKey, userConfigCipherPrefix) {
				continue
			}
			encrypted, err := encryptUserConfigSecret(apiKey)
			if err != nil {
				return "", err
			}
			apiKey = encrypted
		} else {
			if !strings.HasPrefix(apiKey, userConfigCipherPrefix) {
				continue
			}
			decrypted, err := decryptUserConfigSecret(apiKey)
			if err != nil {
				apiKey = ""
			} else {
				apiKey = decrypted
			}
		}
		encoded, err := json.Marshal(apiKey)
		if err != nil {
			return "", err
		}
		channel["apiKey"] = encoded
		changed = true
	}
	if !changed {
		return raw, nil
	}
	encodedChannels, err := json.Marshal(channels)
	if err != nil {
		return "", err
	}
	configData["localChannels"] = encodedChannels
	encoded, err := json.Marshal(configData)
	return string(encoded), err
}

func encryptUserConfigSecret(secret string) (string, error) {
	aead, err := userConfigAEAD()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := aead.Seal(nonce, nonce, []byte(secret), nil)
	return userConfigCipherPrefix + base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptUserConfigSecret(secret string) (string, error) {
	aead, err := userConfigAEAD()
	if err != nil {
		return "", err
	}
	encoded := strings.TrimPrefix(secret, userConfigCipherPrefix)
	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	if len(ciphertext) < aead.NonceSize() {
		return "", errors.New("invalid encrypted user config secret")
	}
	nonce, ciphertext := ciphertext[:aead.NonceSize()], ciphertext[aead.NonceSize():]
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	return string(plaintext), err
}

// EncryptLegacyUserModelConfigs encrypts plaintext API keys already stored in the database.
func EncryptLegacyUserModelConfigs() error {
	db, err := DB()
	if err != nil {
		return err
	}
	var configs []model.UserConfig
	if err := db.Select("user_id", "model_config").Find(&configs).Error; err != nil {
		return err
	}
	for _, config := range configs {
		encrypted, err := encryptUserModelConfig(config.ModelConfig)
		if err != nil {
			return err
		}
		if encrypted != config.ModelConfig {
			if err := db.Model(&model.UserConfig{}).Where("user_id = ?", config.UserID).Update("model_config", encrypted).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
