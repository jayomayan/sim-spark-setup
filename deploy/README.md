# Standalone deployment

Deployment tooling is being prepared for an Ubuntu VM running the application and its own PostgreSQL-backed authentication/data services. A plain PostgreSQL installation is not sufficient: the application also uses authentication, the data API and row-level security.

The hosted application is not switched to the VM by these files. Existing users, records and encrypted credentials are not automatically copied.