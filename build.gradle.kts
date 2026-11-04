plugins {
    `java-library`
    `maven-publish`
}

group = "com.youngminkim.recanet"
version = "0.1.0-SNAPSHOT"

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
    withSourcesJar()
    withJavadocJar()
}

dependencies {
    implementation("io.privy.api:privy-java:0.59.0")
    implementation("com.nimbusds:nimbus-jose-jwt:10.10")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.22.1")
    implementation("org.bouncycastle:bcprov-jdk15to18:1.83")
    implementation("io.github.erdtman:java-json-canonicalization:1.1")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform { excludeTags("live-dmrvn") } }

tasks.register<Test>("dmrvnPetLiveTest") {
    group = "verification"
    description = "Opt-in PET testnet E2E; test-only user signature, real Privy Relay and Greenfield"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform { includeTags("live-dmrvn") }
    testLogging.showStandardStreams = true
    outputs.upToDateWhen { false }
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") { from(components["java"]) }
    }
}

val examples by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output + configurations.runtimeClasspath.get()
    runtimeClasspath += output + compileClasspath
}

tasks.register<JavaExec>("dmrvnDiagnostics") {
    group = "verification"
    description = "Read-only DMRVN testnet checks; no transactions or wallet creation"
    classpath = examples.runtimeClasspath
    mainClass.set("com.youngminkim.recanet.dmrvn.DmrvnDiagnostics")
    args(providers.gradleProperty("dmrvnMode").getOrElse("chain"))
}

tasks.register<JavaExec>("dmrvnPet") {
    group = "verification"
    description = "Explicit PET testnet workflow; evidence/submit can spend testnet gas"
    classpath = examples.runtimeClasspath
    mainClass.set("com.youngminkim.recanet.dmrvn.DmrvnPetExample")
    args(providers.gradleProperty("dmrvnAction").getOrElse("read"))
}
