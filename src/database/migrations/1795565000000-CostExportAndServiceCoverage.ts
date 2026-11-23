import { MigrationInterface, QueryRunner } from "typeorm";

export class CostExportAndServiceCoverage1795565000000 implements MigrationInterface {
    name = 'CostExportAndServiceCoverage1795565000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const types = [
            'RDS_STORAGE_SHRINK',
            'RDS_STORAGE_TYPE',
            'RDS_BACKUP_EXCESS',
            'AURORA_READER_IDLE',
            'AURORA_CLUSTER_IDLE',
            'AURORA_SERVERLESS_MIN_CAPACITY',
            'AURORA_STORAGE_MODE',
            'S3_LIFECYCLE',
            'LAMBDA_ARM64',
            'LAMBDA_PROVISIONED_CONCURRENCY',
        ];
        for (const value of types) {
            await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS '${value}'`);
        }
        await queryRunner.query(`CREATE TABLE "cost_usage_daily" ("awsAccountId" uuid NOT NULL, "billingPeriod" character varying(7) NOT NULL, "day" date NOT NULL, "resourceId" character varying(512) NOT NULL, "service" character varying(64) NOT NULL, "organizationId" uuid NOT NULL, "cost" numeric(18,8) NOT NULL, "hours" numeric(18,8) NOT NULL, "hourlyCost" numeric(18,8) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', CONSTRAINT "PK_cost_usage_daily" PRIMARY KEY ("awsAccountId", "billingPeriod", "day", "resourceId", "service"))`);
        await queryRunner.query(`CREATE INDEX "IDX_beac0c2fef41faff1fa08d3f64" ON "cost_usage_daily" ("awsAccountId", "day")`);
        await queryRunner.query(`CREATE INDEX "IDX_b7cd9cf3eba310e39fef9b49a6" ON "cost_usage_daily" ("awsAccountId", "resourceId", "day")`);
        await queryRunner.query(`ALTER TABLE "cost_usage_daily" ADD CONSTRAINT "FK_4136217b5896a5a06d04a9517de" FOREIGN KEY ("awsAccountId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "aws_accounts" ADD "costExport" jsonb, ADD "rdsBackup" jsonb`);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" ADD "connectionMode" character varying(16) NOT NULL DEFAULT 'AGENT', ADD "eksClusterName" character varying(100), ADD "eksRegion" character varying(32), ADD "lastError" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" DROP COLUMN "lastError", DROP COLUMN "eksRegion", DROP COLUMN "eksClusterName", DROP COLUMN "connectionMode"`);
        await queryRunner.query(`ALTER TABLE "aws_accounts" DROP COLUMN "rdsBackup", DROP COLUMN "costExport"`);
        await queryRunner.query(`DROP TABLE "cost_usage_daily"`);
    }
}
