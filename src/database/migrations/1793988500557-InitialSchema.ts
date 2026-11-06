import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1793988500557 implements MigrationInterface {
    name = 'InitialSchema1793988500557'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."organizations_status_enum" AS ENUM('ACTIVE', 'SUSPENDED')`);
        await queryRunner.query(`CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(160) NOT NULL, "slug" character varying(80) NOT NULL, "status" "public"."organizations_status_enum" NOT NULL DEFAULT 'ACTIVE', "suspendedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_963693341bd612aa01ddf3a4b6" ON "organizations" ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_f3770f157bd77d83ab022e92fc" ON "organizations" ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."organization_role" AS ENUM('ORG_ADMIN', 'ORG_MEMBER', 'VIEWER')`);
        await queryRunner.query(`CREATE TABLE "organization_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "userId" uuid NOT NULL, "role" "public"."organization_role" NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_af79a22d50256af35812ba60a87" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_26f83117dea41b00841385b982" ON "organization_users" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c4a44a1be146c6c6197f82725d" ON "organization_users" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0e9e34aea82db89810e601efaf" ON "organization_users" ("organizationId", "userId") `);
        await queryRunner.query(`CREATE TYPE "public"."platform_role" AS ENUM('SUPER_ADMIN')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(254) NOT NULL, "name" character varying(120) NOT NULL, "passwordHash" character varying NOT NULL, "platformRole" "public"."platform_role", "isActive" boolean NOT NULL DEFAULT true, "lastLoginAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TYPE "public"."aws_accounts_status_enum" AS ENUM('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED')`);
        await queryRunner.query(`CREATE TABLE "aws_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "awsAccountId" character varying(12) NOT NULL, "name" character varying(120) NOT NULL, "roleArn" character varying(2048), "externalId" character varying(64) NOT NULL, "defaultRegion" character varying(32) NOT NULL, "regions" text array NOT NULL DEFAULT '{}', "status" "public"."aws_accounts_status_enum" NOT NULL DEFAULT 'PENDING', "lastScanAt" TIMESTAMP WITH TIME ZONE, "lastCostSyncAt" TIMESTAMP WITH TIME ZONE, "lastOptimizerSyncAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "lastErrorAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c7c5fd76df4fcf21d737400775b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5ff0ecdc0c30c8e5def77156f3" ON "aws_accounts" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_822c04a8c45a6aea79ee7a93ac" ON "aws_accounts" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_de11e006f3c740c86084578f15" ON "aws_accounts" ("organizationId", "awsAccountId") `);
        await queryRunner.query(`CREATE TYPE "public"."recommendations_type_enum" AS ENUM('EC2_RIGHTSIZING', 'EC2_IDLE', 'EBS_UNUSED', 'EBS_OPTIMIZATION', 'RDS_RIGHTSIZING', 'LAMBDA_RIGHTSIZING', 'RESOURCE_IDLE')`);
        await queryRunner.query(`CREATE TYPE "public"."recommendations_source_enum" AS ENUM('COMPUTE_OPTIMIZER', 'CCG_HEURISTIC')`);
        await queryRunner.query(`CREATE TYPE "public"."level" AS ENUM('LOW', 'MEDIUM', 'HIGH')`);
        await queryRunner.query(`CREATE TYPE "public"."recommendations_status_enum" AS ENUM('OPEN', 'REVIEWING', 'ACCEPTED', 'REJECTED', 'IMPLEMENTED', 'RESOLVED')`);
        await queryRunner.query(`CREATE TABLE "recommendations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "awsAccountId" uuid NOT NULL, "resourceId" character varying(512) NOT NULL, "resourceArn" character varying(2048), "service" character varying(64) NOT NULL, "type" "public"."recommendations_type_enum" NOT NULL, "source" "public"."recommendations_source_enum" NOT NULL, "title" character varying(255) NOT NULL, "description" text NOT NULL, "severity" "public"."level" NOT NULL, "risk" "public"."level" NOT NULL, "confidence" "public"."level" NOT NULL, "currentMonthlyCost" numeric(14,2), "recommendedMonthlyCost" numeric(14,2), "estimatedMonthlySavings" numeric(14,2), "estimatedYearlySavings" numeric(14,2), "realizedMonthlySavings" numeric(14,2), "currency" character varying(3) NOT NULL DEFAULT 'USD', "status" "public"."recommendations_status_enum" NOT NULL DEFAULT 'OPEN', "metadata" jsonb NOT NULL DEFAULT '{}', "statusChangedBy" uuid, "acceptedAt" TIMESTAMP WITH TIME ZONE, "implementedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_23a8d2db26db8cabb6ae9d6cd87" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3638b2deb3c9e2ac7352da78b2" ON "recommendations" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6ec2d9917e55967f8a67b9a460" ON "recommendations" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_2464dd5fb592be6a16b1eb3fc8" ON "recommendations" ("awsAccountId", "resourceId", "type") `);
        await queryRunner.query(`CREATE INDEX "IDX_eaf978c86d51043e21543f9fb0" ON "recommendations" ("organizationId", "type") `);
        await queryRunner.query(`CREATE INDEX "IDX_fba99540b1ff347db83d88312b" ON "recommendations" ("organizationId", "status") `);
        await queryRunner.query(`CREATE TABLE "aws_resources" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "awsAccountId" uuid NOT NULL, "arn" character varying(2048) NOT NULL, "resourceId" character varying(512) NOT NULL, "service" character varying(64) NOT NULL, "resourceType" character varying(128) NOT NULL, "region" character varying(32), "name" character varying(512), "metadata" jsonb NOT NULL DEFAULT '{}', "discoveredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f64f2a56682b10ffc42a4b53fd7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4c2e4446d8c84b2714bed804df" ON "aws_resources" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1162167cb2e962009f26ab354c" ON "aws_resources" ("awsAccountId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1206890a1ca216db8e1a3999b9" ON "aws_resources" ("resourceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_98def580738907d5c0bfda1d89" ON "aws_resources" ("lastSeenAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_d5443529a371e1356ab398d899" ON "aws_resources" ("organizationId", "service", "resourceType") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b731ed6dec3165dd7b6ff18073" ON "aws_resources" ("awsAccountId", "arn") `);
        await queryRunner.query(`CREATE TYPE "public"."cost_snapshots_granularity_enum" AS ENUM('DAILY', 'MONTHLY')`);
        await queryRunner.query(`CREATE TYPE "public"."cost_snapshots_kind_enum" AS ENUM('ACTUAL', 'FORECAST')`);
        await queryRunner.query(`CREATE TABLE "cost_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "awsAccountId" uuid NOT NULL, "service" character varying(128), "resourceId" character varying(512), "amount" numeric(14,4) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "granularity" "public"."cost_snapshots_granularity_enum" NOT NULL, "kind" "public"."cost_snapshots_kind_enum" NOT NULL DEFAULT 'ACTUAL', "periodStart" date NOT NULL, "periodEnd" date NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d2958ea9b14c1e2d5c0f7a61b92" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cb2fa6861e208460a1eaf392b6" ON "cost_snapshots" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_af63560d551faf8d070a46f2d0" ON "cost_snapshots" ("resourceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_171d64c41bb6b9b11e32de34c5" ON "cost_snapshots" ("awsAccountId", "granularity", "kind", "periodStart") `);
        await queryRunner.query(`CREATE INDEX "IDX_962d0ee637c58afb0daef3b06e" ON "cost_snapshots" ("organizationId", "granularity", "periodStart") `);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('USER_LOGIN', 'AWS_CONNECTED', 'AWS_DISCONNECTED', 'AWS_CONNECTION_TESTED', 'SCAN_STARTED', 'SCAN_FINISHED', 'SCAN_FAILED', 'RECOMMENDATION_ACCEPTED', 'RECOMMENDATION_REJECTED')`);
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid, "userId" uuid, "action" "public"."audit_logs_action_enum" NOT NULL, "targetType" character varying(64), "targetId" character varying(512), "metadata" jsonb NOT NULL DEFAULT '{}', "ip" character varying(64), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0ec936941eb8556fcd7a1f0eae" ON "audit_logs" ("action", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_9885c0f9a2e4081ebae4313d87" ON "audit_logs" ("organizationId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "organization_users" ADD CONSTRAINT "FK_26f83117dea41b00841385b9821" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_users" ADD CONSTRAINT "FK_c4a44a1be146c6c6197f82725d8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "aws_accounts" ADD CONSTRAINT "FK_5ff0ecdc0c30c8e5def77156f30" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recommendations" ADD CONSTRAINT "FK_52505c002b2bcabe71552f16ed7" FOREIGN KEY ("awsAccountId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "aws_resources" ADD CONSTRAINT "FK_1162167cb2e962009f26ab354c3" FOREIGN KEY ("awsAccountId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cost_snapshots" ADD CONSTRAINT "FK_9120accba983c2049a23de263fb" FOREIGN KEY ("awsAccountId") REFERENCES "aws_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cost_snapshots" DROP CONSTRAINT "FK_9120accba983c2049a23de263fb"`);
        await queryRunner.query(`ALTER TABLE "aws_resources" DROP CONSTRAINT "FK_1162167cb2e962009f26ab354c3"`);
        await queryRunner.query(`ALTER TABLE "recommendations" DROP CONSTRAINT "FK_52505c002b2bcabe71552f16ed7"`);
        await queryRunner.query(`ALTER TABLE "aws_accounts" DROP CONSTRAINT "FK_5ff0ecdc0c30c8e5def77156f30"`);
        await queryRunner.query(`ALTER TABLE "organization_users" DROP CONSTRAINT "FK_c4a44a1be146c6c6197f82725d8"`);
        await queryRunner.query(`ALTER TABLE "organization_users" DROP CONSTRAINT "FK_26f83117dea41b00841385b9821"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9885c0f9a2e4081ebae4313d87"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ec936941eb8556fcd7a1f0eae"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_962d0ee637c58afb0daef3b06e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_171d64c41bb6b9b11e32de34c5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af63560d551faf8d070a46f2d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb2fa6861e208460a1eaf392b6"`);
        await queryRunner.query(`DROP TABLE "cost_snapshots"`);
        await queryRunner.query(`DROP TYPE "public"."cost_snapshots_kind_enum"`);
        await queryRunner.query(`DROP TYPE "public"."cost_snapshots_granularity_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b731ed6dec3165dd7b6ff18073"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d5443529a371e1356ab398d899"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_98def580738907d5c0bfda1d89"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1206890a1ca216db8e1a3999b9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1162167cb2e962009f26ab354c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4c2e4446d8c84b2714bed804df"`);
        await queryRunner.query(`DROP TABLE "aws_resources"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fba99540b1ff347db83d88312b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eaf978c86d51043e21543f9fb0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2464dd5fb592be6a16b1eb3fc8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6ec2d9917e55967f8a67b9a460"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3638b2deb3c9e2ac7352da78b2"`);
        await queryRunner.query(`DROP TABLE "recommendations"`);
        await queryRunner.query(`DROP TYPE "public"."recommendations_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."level"`);
        await queryRunner.query(`DROP TYPE "public"."recommendations_source_enum"`);
        await queryRunner.query(`DROP TYPE "public"."recommendations_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_de11e006f3c740c86084578f15"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_822c04a8c45a6aea79ee7a93ac"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ff0ecdc0c30c8e5def77156f3"`);
        await queryRunner.query(`DROP TABLE "aws_accounts"`);
        await queryRunner.query(`DROP TYPE "public"."aws_accounts_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."platform_role"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e9e34aea82db89810e601efaf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c4a44a1be146c6c6197f82725d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_26f83117dea41b00841385b982"`);
        await queryRunner.query(`DROP TABLE "organization_users"`);
        await queryRunner.query(`DROP TYPE "public"."organization_role"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3770f157bd77d83ab022e92fc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_963693341bd612aa01ddf3a4b6"`);
        await queryRunner.query(`DROP TABLE "organizations"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_status_enum"`);
    }

}
