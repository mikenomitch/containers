package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func handler(w http.ResponseWriter, r *http.Request) {
	message := os.Getenv("MESSAGE")

	fmt.Fprintf(w, "Hi, I'm a container and this is my message: %s", message)
}

func errorHandler(w http.ResponseWriter, r *http.Request) {
	// panics
	panic("This is a panic")
}

func main() {
	http.HandleFunc("/", handler)
	http.HandleFunc("/container", handler)
	http.HandleFunc("/error", errorHandler)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
