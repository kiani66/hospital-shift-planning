-- Runs once when the local Docker volume is first created.
-- hsp_dev is created by POSTGRES_DB; this adds the integration-test database.
CREATE DATABASE hsp_test OWNER hsp;
