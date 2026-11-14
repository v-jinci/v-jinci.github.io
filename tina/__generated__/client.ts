import { createClient } from "tinacms/dist/client";
import { queries } from "./types.js";
export const client = createClient({ url: "http://localhost:4001/graphql", token: "63283ae37561ea645896c59302453fe5612d02a7", queries,  });
export default client;
  