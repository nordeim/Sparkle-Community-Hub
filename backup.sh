#!/bin/bash
# scripts/backup.sh

# Database backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Upload to S3
aws s3 cp backup_*.sql s3://sparkle-universe-backups/

# Clean old backups
find . -name "backup_*.sql" -mtime +7 -delete

# Backup user uploads
aws s3 sync s3://sparkle-universe-uploads s3://sparkle-universe-backups/uploads/
