import { MigrationInterface, QueryRunner } from "typeorm";

export class SnapshotRecommendations1795478500000 implements MigrationInterface {
    name = 'SnapshotRecommendations1795478500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const value of ['EBS_SNAPSHOT_OLD', 'RDS_SNAPSHOT_OLD']) {
            await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS '${value}'`);
        }
    }

    public async down(): Promise<void> {}
}
