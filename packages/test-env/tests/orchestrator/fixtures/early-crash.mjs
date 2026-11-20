setTimeout(() => {
  console.error("boom-early");
  process.exit(1);
}, 50);
