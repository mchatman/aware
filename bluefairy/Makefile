run:
	docker-compose up api

dev:
	uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

test:
	uv run pytest tests/ -v

test-unit:
	uv run pytest tests/unit/ -v

test-cov:
	uv run pytest tests/ --cov=app --cov-report=html

oauth:
	@echo "🔐 Opening Google OAuth authentication..."
	@echo "Please complete authentication in your browser"
	@echo "Note: You must be logged in first"
	@open "http://localhost:8000/api/v1/auth/connectors/google/connect" 2>/dev/null || \
	xdg-open "http://localhost:8000/api/v1/auth/connectors/google/connect" 2>/dev/null || \
	echo "Visit: http://localhost:8000/api/v1/auth/connectors/google/connect"