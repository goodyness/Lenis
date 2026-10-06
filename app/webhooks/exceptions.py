class LenisWebhookSignatureError(Exception):
    """Raised when webhook signature verification fails."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
