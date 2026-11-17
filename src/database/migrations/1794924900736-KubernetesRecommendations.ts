import { MigrationInterface, QueryRunner } from "typeorm";

export class KubernetesRecommendations1794924900736 implements MigrationInterface {
    name = 'KubernetesRecommendations1794924900736'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const value of ['K8S_WORKLOAD_RIGHTSIZING', 'K8S_NODE_CONSOLIDATION', 'K8S_WORKLOAD_UNDERSIZED']) {
            await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS '${value}'`);
        }
        await queryRunner.query(`CREATE TABLE "kubernetes_workload_usage_daily" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "namespace" character varying(253) NOT NULL, "kind" character varying(32) NOT NULL, "name" character varying(253) NOT NULL, "day" date NOT NULL, "maxCpuPerPod" numeric(10,3), "maxMemoryPerPodBytes" bigint, "samples" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_751f9a88be25d8e5efb4a8fb3b0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4f583ce0013b02b8572ca5c787" ON "kubernetes_workload_usage_daily" ("day") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cd0c9fc2717e7c1994585a591f" ON "kubernetes_workload_usage_daily" ("clusterId", "namespace", "kind", "name", "day") `);
        await queryRunner.query(`ALTER TABLE "kubernetes_workload_usage_daily" ADD CONSTRAINT "FK_c4cbe0ae55e058fcc2aa5c4773c" FOREIGN KEY ("clusterId") REFERENCES "kubernetes_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TABLE "kubernetes_container_usage_daily" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "namespace" character varying(253) NOT NULL, "kind" character varying(32) NOT NULL, "name" character varying(253) NOT NULL, "container" character varying(253) NOT NULL, "day" date NOT NULL, "maxCpuCores" numeric(10,3), "maxMemoryBytes" bigint, "samples" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_6fbc534d74186b99d4a7b7f7417" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8bb3978b68d3d529441eba0167" ON "kubernetes_container_usage_daily" ("day") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_143ff86960065f86fefb0a9197" ON "kubernetes_container_usage_daily" ("clusterId", "namespace", "kind", "name", "container", "day") `);
        await queryRunner.query(`ALTER TABLE "kubernetes_container_usage_daily" ADD CONSTRAINT "FK_590ca2a7c08ec0e420c0ed5f213" FOREIGN KEY ("clusterId") REFERENCES "kubernetes_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kubernetes_workloads" ADD "containers" jsonb`);
        await queryRunner.query(`ALTER TABLE "kubernetes_usage_samples" ADD "requestsCpu" numeric(10,3)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_usage_samples" DROP COLUMN "requestsCpu"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_workloads" DROP COLUMN "containers"`);
        await queryRunner.query(`DROP TABLE "kubernetes_container_usage_daily"`);
        await queryRunner.query(`DROP TABLE "kubernetes_workload_usage_daily"`);
    }
}
