/**
 * Universal AWS AppSync GraphQL Client
 *
 * Facilitates direct communication between the Next.js client and AWS AppSync,
 * automatically applying x-api-key and Bearer JWT authorization headers.
 */

export const APPSYNC_ENDPOINT =
  typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_APPSYNC_ENDPOINT || "" : "";
export const APPSYNC_API_KEY =
  typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_APPSYNC_API_KEY || "" : "";
export const AWS_REGION =
  typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_AWS_REGION || "us-east-1" : "us-east-1";

/**
 * Returns true if AWS AppSync endpoint is configured in the environment.
 */
export function isAppSyncConfigured(): boolean {
  return Boolean(APPSYNC_ENDPOINT && APPSYNC_ENDPOINT.startsWith("http"));
}

export interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: (string | number)[];
  extensions?: Record<string, any>;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * Executes a GraphQL Query or Mutation against AWS AppSync
 */
export async function graphqlRequest<T>(
  query: string,
  variables: Record<string, any> = {},
  token?: string | null
): Promise<T> {
  if (!isAppSyncConfigured()) {
    throw new Error("AWS AppSync endpoint is not configured (NEXT_PUBLIC_APPSYNC_ENDPOINT is missing).");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Attach AppSync API key if configured
  if (APPSYNC_API_KEY) {
    headers["x-api-key"] = APPSYNC_API_KEY;
  }

  // Attach JWT Bearer Token if user is logged in
  if (token) {
    headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }

  const response = await fetch(APPSYNC_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`AppSync HTTP Error (${response.status}): ${errorText || response.statusText}`);
  }

  const json: GraphQLResponse<T> = await response.json();

  if (json.errors && json.errors.length > 0) {
    const firstError = json.errors[0];
    const message = firstError?.message || "GraphQL operation failed.";
    const error = new Error(message);
    (error as any).graphQLErrors = json.errors;
    throw error;
  }

  if (json.data === undefined) {
    throw new Error("AppSync response returned empty data.");
  }

  return json.data;
}

