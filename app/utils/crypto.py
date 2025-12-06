import secrets
import hashlib
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from OpenSSL import crypto


def get_cert_SANs(cert: bytes):
    cert = x509.load_pem_x509_certificate(cert, default_backend())
    san_list = []
    for extension in cert.extensions:
        if isinstance(extension.value, x509.SubjectAlternativeName):
            san = extension.value
            for name in san:
                san_list.append(name.value)
    return san_list


def generate_certificate(cn: str = None):
    k = crypto.PKey()
    k.generate_key(crypto.TYPE_RSA, 4096)
    cert = crypto.X509()
    cert.get_subject().CN = cn if cn else generate_unique_cn()
    cert.gmtime_adj_notBefore(0)
    # Use a shorter validity to avoid overflowing 32-bit ints on platforms
    # when using OpenSSL wrapper functions (e.g., 10 years).
    cert.gmtime_adj_notAfter(10 * 365 * 24 * 60 * 60)
    cert.set_issuer(cert.get_subject())
    cert.set_pubkey(k)
    cert.sign(k, "sha512")
    cert_pem = crypto.dump_certificate(crypto.FILETYPE_PEM, cert).decode("utf-8")
    key_pem = crypto.dump_privatekey(crypto.FILETYPE_PEM, k).decode("utf-8")

    return {"cert": cert_pem, "key": key_pem}


def generate_unique_cn(node_id: int = None, node_name: str = None) -> str:
    return secrets.token_hex(16)


def extract_public_key_from_certificate(cert_pem: str) -> str:
    """
    Extract a PEM-encoded public key from a PEM certificate string.
    """
    if not cert_pem:
        raise ValueError("Certificate is empty")

    cert = x509.load_pem_x509_certificate(
        cert_pem.encode("utf-8") if isinstance(cert_pem, str) else cert_pem,
        default_backend(),
    )
    public_key = cert.public_key()
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
