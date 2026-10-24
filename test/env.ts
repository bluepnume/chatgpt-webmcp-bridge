// The two origins the test server answers on. The suite runs on localhost;
// the same server answers at the IPv6 loopback literal, which the browser
// treats as a second origin.

export type TestEnv = {
    readonly origin : string,
    readonly foreignOrigin : string,
};

export const getTestEnv = () : TestEnv => ({
    origin:        `http://localhost:${ location.port }`,
    foreignOrigin: `http://[::1]:${ location.port }`
});
