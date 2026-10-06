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
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }

publishing {
    publications {
        create<MavenPublication>("mavenJava") { from(components["java"]) }
    }
}
