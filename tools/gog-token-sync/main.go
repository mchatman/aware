// gog-token-sync: Sync Google tokens from Aware control plane to gog's keyring
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/99designs/keyring"
)

type storedToken struct {
	RefreshToken string    `json:"refresh_token"`
	Services     []string  `json:"services,omitempty"`
	Scopes       []string  `json:"scopes,omitempty"`
	CreatedAt    time.Time `json:"created_at,omitempty"`
}

func main() {
	email := flag.String("email", "", "Google account email")
	refreshToken := flag.String("refresh-token", "", "OAuth refresh token")
	services := flag.String("services", "gmail,calendar,drive,contacts,docs,sheets", "Comma-separated services")
	password := flag.String("password", "", "Keyring password (or set GOG_KEYRING_PASSWORD)")
	flag.Parse()

	if *email == "" || *refreshToken == "" {
		fmt.Fprintln(os.Stderr, "Usage: gog-token-sync --email user@gmail.com --refresh-token TOKEN")
		os.Exit(1)
	}

	keyringPassword := *password
	if keyringPassword == "" {
		keyringPassword = os.Getenv("GOG_KEYRING_PASSWORD")
	}
	if keyringPassword == "" {
		fmt.Fprintln(os.Stderr, "Error: keyring password required (--password or GOG_KEYRING_PASSWORD)")
		os.Exit(1)
	}

	// Open gog's keyring (file backend)
	ring, err := keyring.Open(keyring.Config{
		ServiceName:             "gog",
		FileDir:                 os.ExpandEnv("$HOME/.config/gog"),
		FilePasswordFunc:        keyring.FixedStringPrompt(keyringPassword),
		AllowedBackends:         []keyring.BackendType{keyring.FileBackend},
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening keyring: %v\n", err)
		os.Exit(1)
	}

	// Parse services
	var serviceList []string
	for _, s := range splitServices(*services) {
		serviceList = append(serviceList, s)
	}

	// Build token payload
	payload, err := json.Marshal(storedToken{
		RefreshToken: *refreshToken,
		Services:     serviceList,
		CreatedAt:    time.Now().UTC(),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding token: %v\n", err)
		os.Exit(1)
	}

	// Store token with gog's key format
	key := fmt.Sprintf("token:default:%s", *email)
	if err := ring.Set(keyring.Item{Key: key, Data: payload}); err != nil {
		fmt.Fprintf(os.Stderr, "Error storing token: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✓ Token synced for %s\n", *email)
}

func splitServices(s string) []string {
	var result []string
	current := ""
	for _, c := range s {
		if c == ',' {
			if current != "" {
				result = append(result, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}
