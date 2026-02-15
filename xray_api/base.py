import grpc


class XRayBase(object):
    def __init__(
        self,
        address: str,
        port: int,
        ssl_cert: str = None,
        ssl_target_name: str = None,
        channel_options: tuple | list | None = None,
    ):
        self.address = address
        self.port = port
        options = list(channel_options or [])

        if ssl_cert is None:
            self._channel = grpc.insecure_channel(f"{address}:{port}", options=options)
            return

        creds = grpc.ssl_channel_credentials(root_certificates=ssl_cert)
        if ssl_target_name is not None:
            options.append(
                (
                    "grpc.ssl_target_name_override",
                    ssl_target_name,
                )
            )
        self._channel = grpc.secure_channel(f"{address}:{port}", credentials=creds, options=options)
