import corsAnywhere from "cors-anywhere";
const port = 8080;

corsAnywhere
  .createServer({
    originBlacklist: [], // Allow all origins
    originWhitelist: [], // Allow all origins
    requestHeaders: ["authorization", "x-requested-with"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
  .listen(port, () => {
    console.log(`CORS Anywhere server running on http://localhost:${port}`);
  });
