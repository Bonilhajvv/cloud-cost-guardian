import { MigrationInterface, QueryRunner } from "typeorm";

export class RequestCosts1795719511483 implements MigrationInterface {
    name = 'RequestCosts1795719511483'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "kubernetes_route_usage_hourly" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "hour" TIMESTAMP WITH TIME ZONE NOT NULL, "entryService" character varying(253) NOT NULL, "entryRoute" character varying(253) NOT NULL, "requests" bigint NOT NULL DEFAULT '0', "durationMs" double precision NOT NULL DEFAULT '0', CONSTRAINT "PK_697365dcb9fc68c9a6955b20061" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f42b31fbb01f70199e8659f469" ON "kubernetes_route_usage_hourly" ("hour") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e99a7ef4e4396f610ca94d3457" ON "kubernetes_route_usage_hourly" ("clusterId", "hour", "entryService", "entryRoute") `);
        await queryRunner.query(`CREATE TABLE "kubernetes_route_hop_usage_hourly" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "clusterId" uuid NOT NULL, "hour" TIMESTAMP WITH TIME ZONE NOT NULL, "entryService" character varying(253) NOT NULL, "entryRoute" character varying(253) NOT NULL, "hopKind" character varying(16) NOT NULL, "namespace" character varying(253) NOT NULL DEFAULT '', "workloadKind" character varying(32) NOT NULL DEFAULT '', "workloadName" character varying(253) NOT NULL DEFAULT '', "service" character varying(253) NOT NULL DEFAULT '', "target" character varying(253) NOT NULL DEFAULT '', "spans" bigint NOT NULL DEFAULT '0', "durationMs" double precision NOT NULL DEFAULT '0', CONSTRAINT "PK_e2c50ebc86413f8708a273c6bc2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_176d777a0f7fdeeab121faf85e" ON "kubernetes_route_hop_usage_hourly" ("hour") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_498f009c7405ca06e9ec07f16e" ON "kubernetes_route_hop_usage_hourly" ("clusterId", "hour", "entryService", "entryRoute", "hopKind", "namespace", "workloadKind", "workloadName", "service", "target") `);
        await queryRunner.query(`ALTER TABLE "kubernetes_route_usage_hourly" ADD CONSTRAINT "FK_d76634935653831ffbdf23e5f35" FOREIGN KEY ("clusterId") REFERENCES "kubernetes_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kubernetes_route_hop_usage_hourly" ADD CONSTRAINT "FK_426c26ba33a31b4d7d068c258d7" FOREIGN KEY ("clusterId") REFERENCES "kubernetes_clusters"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_route_hop_usage_hourly" DROP CONSTRAINT "FK_426c26ba33a31b4d7d068c258d7"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_route_usage_hourly" DROP CONSTRAINT "FK_d76634935653831ffbdf23e5f35"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_498f009c7405ca06e9ec07f16e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_176d777a0f7fdeeab121faf85e"`);
        await queryRunner.query(`DROP TABLE "kubernetes_route_hop_usage_hourly"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e99a7ef4e4396f610ca94d3457"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f42b31fbb01f70199e8659f469"`);
        await queryRunner.query(`DROP TABLE "kubernetes_route_usage_hourly"`);
    }

}
