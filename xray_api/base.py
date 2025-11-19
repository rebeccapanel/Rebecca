import grpc
from app.utils.helpers import format_ip_for_url


class XRayBase(object):
    def __init__(
        self,
        address: str,
        port: int,
        ssl_cert: str | bytes | None = None,
        ssl_target_name: str | None = None,
        use_tls: bool = False,
    ):
        self.address = address
        self.port = port

        target = f"{format_ip_for_url(address)}:{port}"

        if not use_tls:
            self._channel = grpc.insecure_channel(target)
            return

        root_cert = None
        if isinstance(ssl_cert, str) and ssl_cert:
            root_cert = ssl_cert.encode("utf-8")
        elif isinstance(ssl_cert, bytes) and ssl_cert:
            root_cert = ssl_cert

        creds = grpc.ssl_channel_credentials(root_certificates=root_cert)
        options = ()
        if ssl_target_name:
            options = (("grpc.ssl_target_name_override", ssl_target_name),)

        self._channel = grpc.secure_channel(
            target, credentials=creds, options=options
        )
