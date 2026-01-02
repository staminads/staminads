.PHONY: help install dev build test test-e2e test-cov lint format docker-up docker-down openapi

# Default target
help:
	@echo "Staminads Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install      - Install dependencies"
	@echo "  make docker-up    - Start ClickHouse"
	@echo "  make docker-down  - Stop ClickHouse"
	@echo ""
	@echo "Development:"
	@echo "  make dev          - Start API in dev mode"
	@echo "  make build        - Build API"
	@echo ""
	@echo "Testing:"
	@echo "  make test         - Run unit tests"
	@echo "  make test-e2e     - Run e2e tests"
	@echo "  make test-cov     - Run tests with coverage"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint         - Run linter"
	@echo "  make format       - Format code"
	@echo ""
	@echo "Documentation:"
	@echo "  make openapi      - Generate OpenAPI spec"

# Setup
install:
	cd api && npm install

docker-up:
	docker compose up -d

docker-down:
	docker compose down

# Development
dev:
	cd api && npm run start:dev

build:
	cd api && npm run build

# Testing
test:
	cd api && npm test

test-e2e:
	cd api && npm run test:e2e

test-cov:
	cd api && npm run test:cov

# Code Quality
lint:
	cd api && npm run lint

format:
	cd api && npm run format

# Documentation
openapi:
	cd api && npm run openapi:generate
