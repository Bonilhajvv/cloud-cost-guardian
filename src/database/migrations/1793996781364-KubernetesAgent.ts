import { MigrationInterface, QueryRunner } from "typeorm";

export class KubernetesAgent1793996781364 implements MigrationInterface {
    name = 'KubernetesAgent1793996781364'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."kubernetes_clusters_provider_enum" AS ENUM('EKS', 'SELF_MANAGED', 'GKE', 'AKS', 'UNKNOWN')`);
        await queryRunner.query(`CREATE TYPE "public"."kubernetes_clusters_status_enum" AS ENUM('PENDING', 'CONNECTED', 'STALE', 'REVOKED')`);
        await queryRunner.query(`CREATE TABLE "kubernetes_clusters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "awsAccountId" uuid, "name" character varying(120) NOT NULL, "provider" "public"."kubernetes_clusters_provider_enum" NOT NULL DEFAULT 'UNKNOWN', "status" "public"."kubernetes_clusters_status_enum" NOT NULL DEFAULT 'PENDING', "installTokenHash" character varying(64), "installTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "agentTokenVersion" integer NOT NULL DEFAULT '1', "installMethod" character varying(32), "agentVersion" character varying(32), "kubernetesVersion" character varying(64), "metricsServerAvailable" boolean NOT NULL DEFAULT false, "nodeCount" integer NOT NULL DEFAULT '0', "podCount" integer NOT NULL DEFAULT '0', "lastSeenAt" TIMESTAMP WITH TIME ZONE, "connectedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_987c91930ff0fab868e0f117ee3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_339168e122435d794f59517079" ON "kubernetes_clusters" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9cf7539aff232bd0c3aef957ce" ON "kubernetes_clusters" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e660842e49e0abe9822245dca3" ON "kubernetes_clusters" ("installTokenHash") WHERE "installTokenHash" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e23e2f42d9b46654cca21224a7" ON "kubernetes_clusters" ("organizationId", "name") `);
        await queryRunner.query(`CREATE TABLE "kubernetes_workloads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "namespace" character varying(253) NOT NULL, "kind" character varying(32) NOT NULL, "name" character varying(253) NOT NULL, "desiredReplicas" integer, "podCount" integer NOT NULL DEFAULT '0', "requestsCpu" numeric(10,3), "requestsMemoryBytes" bigint, "limitsCpu" numeric(10,3), "limitsMemoryBytes" bigint, "usageCpu" numeric(10,3), "usageMemoryBytes" bigint, "hpa" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_44544e33bc2cd14901b35cc467e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7864deab4e9488a2f2d4fbde92" ON "kubernetes_workloads" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4880d17e14bbdba5972633dd22" ON "kubernetes_workloads" ("lastSeenAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5a98e2f9a19655ae78411ac82d" ON "kubernetes_workloads" ("clusterId", "namespace", "kind", "name") `);
        await queryRunner.query(`CREATE TABLE "kubernetes_usage_samples" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "nodeName" character varying(253) NOT NULL, "instanceId" character varying(64), "cpuCores" numeric(10,3), "memoryBytes" bigint, "requestsMemoryBytes" bigint, "allocatableMemoryBytes" bigint, "sampledAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_11aa9914f528871008d11adc499" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f1b0dced4f66774e90f3e4e69c" ON "kubernetes_usage_samples" ("sampledAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_6055405c685c7e8c188da9cdb9" ON "kubernetes_usage_samples" ("clusterId", "nodeName", "sampledAt") `);
        await queryRunner.query(`CREATE TABLE "kubernetes_nodes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "nodeName" character varying(253) NOT NULL, "providerId" character varying(512), "instanceId" character varying(64), "instanceType" character varying(64), "role" character varying(32) NOT NULL, "capacityCpu" numeric(10,3), "capacityMemoryBytes" bigint, "allocatableCpu" numeric(10,3), "allocatableMemoryBytes" bigint, "requestsCpu" numeric(10,3), "requestsMemoryBytes" bigint, "limitsCpu" numeric(10,3), "limitsMemoryBytes" bigint, "usageCpu" numeric(10,3), "usageMemoryBytes" bigint, "podCount" integer NOT NULL DEFAULT '0', "labels" jsonb NOT NULL DEFAULT '{}', "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_f5496eeef9375557732091d6ae8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e6d18b4a3403487cefcf90c829" ON "kubernetes_nodes" ("organizationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_5e27cee79be65a2c1b2a4a3d13" ON "kubernetes_nodes" ("instanceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_314fd5f7d6c447f17e639c91b4" ON "kubernetes_nodes" ("lastSeenAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a1fe9f981c47eec8213343863b" ON "kubernetes_nodes" ("clusterId", "nodeName") `);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ec936941eb8556fcd7a1f0eae"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('USER_LOGIN', 'AWS_CONNECTED', 'AWS_DISCONNECTED', 'AWS_CONNECTION_TESTED', 'SCAN_STARTED', 'SCAN_FINISHED', 'SCAN_FAILED', 'RECOMMENDATION_ACCEPTED', 'RECOMMENDATION_REJECTED', 'KUBERNETES_CONNECTED', 'KUBERNETES_REVOKED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::"text"::"public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`CREATE INDEX "IDX_0ec936941eb8556fcd7a1f0eae" ON "audit_logs" ("action", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" ADD CONSTRAINT "FK_339168e122435d794f595170799" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" ADD CONSTRAINT "FK_ae2ebc98a50ca6b135e0a15d142" FOREIGN KEY ("awsAccountId") REFERENCES "aws_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kubernetes_workloads" ADD CONSTRAINT "FK_cafe1d7beaf8b2ad97b067be941" FOREIGN KEY ("clusterId") REFERENCES "kubernetes_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kubernetes_nodes" ADD CONSTRAINT "FK_b62f3a2d600c6fed77db34ee8b3" FOREIGN KEY ("clusterId") REFERENCES "kubernetes_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_nodes" DROP CONSTRAINT "FK_b62f3a2d600c6fed77db34ee8b3"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_workloads" DROP CONSTRAINT "FK_cafe1d7beaf8b2ad97b067be941"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" DROP CONSTRAINT "FK_ae2ebc98a50ca6b135e0a15d142"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" DROP CONSTRAINT "FK_339168e122435d794f595170799"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ec936941eb8556fcd7a1f0eae"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('USER_LOGIN', 'AWS_CONNECTED', 'AWS_DISCONNECTED', 'AWS_CONNECTION_TESTED', 'SCAN_STARTED', 'SCAN_FINISHED', 'SCAN_FAILED', 'RECOMMENDATION_ACCEPTED', 'RECOMMENDATION_REJECTED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
        await queryRunner.query(`CREATE INDEX "IDX_0ec936941eb8556fcd7a1f0eae" ON "audit_logs" ("action", "createdAt") `);
        await queryRunner.query(`DROP INDEX "public"."IDX_a1fe9f981c47eec8213343863b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_314fd5f7d6c447f17e639c91b4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5e27cee79be65a2c1b2a4a3d13"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e6d18b4a3403487cefcf90c829"`);
        await queryRunner.query(`DROP TABLE "kubernetes_nodes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6055405c685c7e8c188da9cdb9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f1b0dced4f66774e90f3e4e69c"`);
        await queryRunner.query(`DROP TABLE "kubernetes_usage_samples"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5a98e2f9a19655ae78411ac82d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4880d17e14bbdba5972633dd22"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7864deab4e9488a2f2d4fbde92"`);
        await queryRunner.query(`DROP TABLE "kubernetes_workloads"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e23e2f42d9b46654cca21224a7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e660842e49e0abe9822245dca3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9cf7539aff232bd0c3aef957ce"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_339168e122435d794f59517079"`);
        await queryRunner.query(`DROP TABLE "kubernetes_clusters"`);
        await queryRunner.query(`DROP TYPE "public"."kubernetes_clusters_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."kubernetes_clusters_provider_enum"`);
    }

}
