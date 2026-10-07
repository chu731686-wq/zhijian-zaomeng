package middleware

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

const (
	anonymousStorageCookieName = "infinite_canvas_anonymous_storage"
	anonymousStorageIssuer     = "infinite-canvas-anonymous-storage"
	anonymousStorageCookieAge  = 365 * 24 * time.Hour
	anonymousStorageBodyLimit  = 129 << 20
)

func AnonymousStorage(c *gin.Context) {
	if c.Request.Method == http.MethodPost {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, anonymousStorageBodyLimit)
	}
	subject, ok := anonymousStorageSubject(c)
	if !ok {
		var err error
		subject, err = newAnonymousStorageSession(c)
		if err != nil {
			handler.FailWithStatus(c.Writer, http.StatusInternalServerError, "匿名存储会话创建失败")
			c.Abort()
			return
		}
	}
	user := model.AuthUser{ID: subject, Username: "anonymous", Role: model.UserRoleGuest}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func anonymousStorageSubject(c *gin.Context) (string, bool) {
	value, err := c.Cookie(anonymousStorageCookieName)
	if err != nil || strings.TrimSpace(value) == "" {
		return "", false
	}
	claims := jwt.RegisteredClaims{}
	token, err := jwt.ParseWithClaims(value, &claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("匿名存储会话无效")
		}
		return []byte(config.Cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid || claims.Issuer != anonymousStorageIssuer || !strings.HasPrefix(claims.Subject, "anonymous-") {
		return "", false
	}
	return claims.Subject, true
}

func newAnonymousStorageSession(c *gin.Context) (string, error) {
	now := time.Now()
	subject := "anonymous-" + uuid.NewString()
	claims := jwt.RegisteredClaims{
		Issuer:    anonymousStorageIssuer,
		Subject:   subject,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(anonymousStorageCookieAge)),
	}
	value, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		return "", err
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     anonymousStorageCookieName,
		Value:    value,
		Path:     "/api/anonymous/files",
		MaxAge:   int(anonymousStorageCookieAge.Seconds()),
		HttpOnly: true,
		Secure:   c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https"),
		SameSite: http.SameSiteLaxMode,
	})
	return subject, nil
}
