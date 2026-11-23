import { MigrationInterface, QueryRunner } from "typeorm";

export class KubernetesClusterUid1795478400000 implements MigrationInterface {
    name = 'KubernetesClusterUid1795478400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" ADD "clusterUid" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" DROP COLUMN "clusterUid"`);
    }
}
