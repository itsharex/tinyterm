FROM redis:6-alpine

RUN apk add --no-cache openssh openssh-sftp-server bash shadow

# Create test users
RUN useradd -m -s /bin/bash testuser && \
    echo "testuser:test123" | chpasswd && \
    echo "root:root123" | chpasswd

# Generate host keys
RUN mkdir -p /var/run/sshd && ssh-keygen -A

# Remove tar command to force TinyTerm fallback path (recursive SFTP mode)
RUN rm -f /bin/tar /usr/bin/tar /usr/local/bin/tar && \
    if command -v tar >/dev/null 2>&1; then echo "tar still exists" && exit 1; fi

# Write sshd_config cleanly
RUN printf '%s\n' \
    'Port 22' \
    'Protocol 2' \
    'HostKey /etc/ssh/ssh_host_rsa_key' \
    'HostKey /etc/ssh/ssh_host_ecdsa_key' \
    'HostKey /etc/ssh/ssh_host_ed25519_key' \
    'PermitRootLogin yes' \
    'PasswordAuthentication yes' \
    'PubkeyAuthentication yes' \
    'AuthorizedKeysFile .ssh/authorized_keys' \
    'X11Forwarding no' \
    'PrintMotd no' \
    'AllowTcpForwarding yes' \
    'Subsystem sftp /usr/lib/ssh/sftp-server' \
    > /etc/ssh/sshd_config

# Create test directory structure for SFTP testing
RUN mkdir -p /home/testuser/documents /home/testuser/projects /home/testuser/uploads /home/testuser/folder-a/sub-a && \
    echo "Hello from TinyTerm no-tar SSH test container!" > /home/testuser/hello.txt && \
    echo "This is a readme file for SFTP download testing." > /home/testuser/documents/readme.txt && \
    echo "Some notes content here." > /home/testuser/documents/notes.txt && \
    echo "nested-file" > /home/testuser/folder-a/sub-a/file.txt && \
    printf '#!/bin/bash\necho deploy script\n' > /home/testuser/projects/deploy.sh && \
    echo "config_value=true" > /home/testuser/projects/config.conf && \
    chown -R testuser:testuser /home/testuser && \
    chmod 755 /home/testuser/projects/deploy.sh

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D", "-e"]
