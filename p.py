import requests
response = requests.get(
  'https://api.restcountries.com/countries/v5?q=canada',
  headers={'Authorization': 'Bearer rc_live_a820ddd8bdb34902bb078b77e5670882'}
)
data = response.json()

print(data)

# celery -A app.core.celery_app.celery_app worker --loglevel=info --pool=solo
# python -m app.cli.bootstrap --email admin@mail.com --password "School123456!"

# celery -A app.core.celery_app.celery_app beat --loglevel=info
# Pay anyone, anywhere,
# in any stablecoin, in one signature

# python -m alembic upgrade head


# Situation	Command
# Apply all pending migrations	python -m alembic upgrade head
# Check current DB revision	python -m alembic current
# See what's pending	python -m alembic history --verbose
# Generate a new migration after model changes	python -m alembic revision --autogenerate -m "description"
# Roll back one migration	python -m alembic downgrade -1

# [2026-10-06 22:07:38,582: INFO/MainProcess] HTTP Request: POST https://polygon-rpc.com "HTTP/1.1 401 Unauthorized"