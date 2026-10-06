# =============================================================================
# Lenis Platform — Multi-stage Dockerfile
# =============================================================================
# Stage 1 (builder): installs Python dependencies into /install
# Stage 2 (runtime): slim image with libmagic + app code, runs as non-root
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: builder — install dependencies
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /build

# Copy dependency manifest and install into a prefix so the runtime stage
# can copy just the installed packages without pip/build tools.
COPY pyproject.toml .

# Install the project dependencies (non-editable) into /install.
# python-magic-bin ships the Windows DLL — harmless on Linux (no-op).
RUN pip install --no-cache-dir --prefix=/install .

# ---------------------------------------------------------------------------
# Stage 2: runtime — lean production image
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Install libmagic system library required by python-magic for server-side
# MIME type detection (Requirement 16.4).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from the builder stage.
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy application source.
COPY . .

# Create a dedicated non-root service account (UID 1001) and transfer
# ownership of the application directory.
RUN useradd -r -u 1001 lenis \
    && chown -R lenis:lenis /app

USER lenis

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
