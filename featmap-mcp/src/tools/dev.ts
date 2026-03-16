import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FeatmapClient } from "../client.js";

export function registerDevTools(server: McpServer, client: FeatmapClient): void {
  server.registerTool(
    "list_projects",
    {
      description:
        "List all projects in the Featmap workspace. " +
        "Use this first to discover available project IDs before calling get_features.",
    },
    async () => {
      const projects = await client.listProjects();
      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get_features",
    {
      description:
        "Get all features for a project with full context: milestones, workflows, subWorkflows, " +
        "comments, and priority. Read the returned 'instructions' field and follow it before " +
        "processing features. Use this to understand the current state of the story map.",
      inputSchema: z.object({
        projectId: z.string().describe("The project UUID to fetch features for"),
      }),
    },
    async ({ projectId }) => {
      const data = await client.getFeatures(projectId);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "update_feature_status",
    {
      description:
        "Change the status of a feature. Use IN_PROGRESS when starting work, CLOSED when done. " +
        "Note: IN_PROGRESS and OPEN both set the feature to open state in the backend.",
      inputSchema: z.object({
        featureId: z.string().describe("The feature UUID to update"),
        status: z
          .enum(["OPEN", "IN_PROGRESS", "CLOSED"])
          .describe("New status for the feature"),
      }),
    },
    async ({ featureId, status }) => {
      const feature = await client.updateStatus(featureId, status);
      return {
        content: [{ type: "text", text: JSON.stringify(feature, null, 2) }],
      };
    }
  );

  server.registerTool(
    "update_feature_annotations",
    {
      description:
        "Write technical notes in the annotations field of a feature. " +
        "Use this to record implementation decisions, PR links, technical debt notes, etc. " +
        "Valid annotation tags (comma-separated): RISKY, UNCLEAR, SPLIT, DEPENDENCY, BLOCKED, " +
        "DISCUSSION, REJECTED, IDEA, RESEARCH. Example: 'RISKY,DEPENDENCY'.",
      inputSchema: z.object({
        featureId: z.string().describe("The feature UUID to annotate"),
        annotations: z
          .string()
          .describe(
            "Comma-separated annotation tags, e.g. 'RISKY,BLOCKED'"
          ),
      }),
    },
    async ({ featureId, annotations }) => {
      const feature = await client.updateAnnotations(featureId, annotations);
      return {
        content: [{ type: "text", text: JSON.stringify(feature, null, 2) }],
      };
    }
  );
}
